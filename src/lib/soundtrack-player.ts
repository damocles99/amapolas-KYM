import { toast } from "@/components/starwind/toast";

export type TrackSource = {
  src: string;
  type: string;
};

export type Track = {
  title: string;
  artist: string;
  sources: TrackSource[];
};

const DEFAULT_VOLUME = 70;

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "00:00";
  }

  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function parseTracks(raw: string | undefined): Track[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((track): track is Track => {
      if (typeof track !== "object" || track === null) return false;
      const candidate = track as Partial<Track>;
      return (
        typeof candidate.title === "string" &&
        typeof candidate.artist === "string" &&
        Array.isArray(candidate.sources) &&
        candidate.sources.length > 0
      );
    });
  } catch {
    return [];
  }
}

function initSoundtrackPlayer(root: HTMLElement) {
  const tracks = parseTracks(root.dataset.tracks);
  if (tracks.length === 0) return;

  const audio = root.querySelector<HTMLAudioElement>(
    "[data-soundtrack-audio]",
  );
  const playBtn = root.querySelector<HTMLButtonElement>(
    "[data-soundtrack-play]",
  );
  const prevBtn = root.querySelector<HTMLButtonElement>(
    "[data-soundtrack-prev]",
  );
  const nextBtn = root.querySelector<HTMLButtonElement>(
    "[data-soundtrack-next]",
  );
  const seek = root.querySelector<HTMLInputElement>("[data-soundtrack-seek]");
  const currentEl = root.querySelector<HTMLElement>(
    "[data-soundtrack-current]",
  );
  const totalEl = root.querySelector<HTMLElement>("[data-soundtrack-total]");
  const titleEl = root.querySelector<HTMLElement>("[data-soundtrack-title]");
  const artistEl = root.querySelector<HTMLElement>("[data-soundtrack-artist]");
  const equalizer = root.querySelector<HTMLElement>(
    "[data-soundtrack-equalizer]",
  );
  const progress = root.querySelector<HTMLElement>(
    "[data-soundtrack-progress]",
  );
  const volume = root.querySelector<HTMLInputElement>(
    "[data-soundtrack-volume]",
  );

  if (
    !audio ||
    !playBtn ||
    !prevBtn ||
    !nextBtn ||
    !seek ||
    !currentEl ||
    !totalEl ||
    !titleEl ||
    !artistEl ||
    !equalizer ||
    !progress ||
    !volume
  ) {
    return;
  }

  const indicator = progress.querySelector<HTMLElement>(
    '[data-slot="progress-indicator"]',
  );

  let trackIndex = 0;
  let candidateIndex = 0;
  let candidates: TrackSource[] = [];
  let hasInteracted = false;
  let isSeeking = false;
  let wantPlaying = false;
  let errorNotified = false;

  function setPlayingUI(playing: boolean) {
    root.dataset.playing = String(playing);
    equalizer?.setAttribute("data-playing", String(playing));
    playBtn?.setAttribute("aria-pressed", String(playing));
    playBtn?.setAttribute(
      "aria-label",
      playing ? "Pausar melodía" : "Reproducir melodía",
    );
  }

  function renderProgress(updateSeek = true) {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const ratio =
      duration > 0 ? Math.min(1, Math.max(0, current / duration)) : 0;

    if (indicator) {
      indicator.style.transform = `translateX(-${100 - ratio * 100}%)`;
    }

    progress?.setAttribute("aria-valuemax", String(Math.round(duration)));
    progress?.setAttribute("aria-valuenow", String(Math.round(current)));
    currentEl.textContent = formatTime(current);
    totalEl.textContent = formatTime(duration);

    if (updateSeek && !isSeeking) {
      seek.max = String(duration);
      seek.value = String(Math.min(current, duration || current));
      seek.disabled = duration <= 0;
      seek.setAttribute("aria-valuetext", formatTime(current));
    }
  }

  function renderTrackMeta(track: Track) {
    titleEl.textContent = track.title;
    artistEl.textContent = track.artist;
  }

  function orderSources(track: Track): TrackSource[] {
    const playable: TrackSource[] = [];
    const rest: TrackSource[] = [];

    for (const source of track.sources) {
      const support = audio.canPlayType(source.type);
      if (support === "probably" || support === "maybe") {
        playable.push(source);
      } else {
        rest.push(source);
      }
    }

    return [...playable, ...rest];
  }

  function notifyPlaying() {
    const track = tracks[trackIndex];
    toast.success(`Reproduciendo: ${track.title}`, {
      description: track.artist,
    });
  }

  function notifyPlaybackError() {
    if (!hasInteracted || errorNotified) return;

    errorNotified = true;
    const track = tracks[trackIndex];
    toast.error(`No pudimos reproducir «${track.title}»`, {
      description:
        "Revisa que el archivo de audio exista en public/audio y que el navegador soporte el formato.",
    });
  }

  async function startPlayback(announce: boolean) {
    wantPlaying = true;

    try {
      await audio.play();
      errorNotified = false;
      if (announce) notifyPlaying();
    } catch {
      // Decoding/source errors also fire the `error` event, which handles
      // fallbacks. If every candidate was already exhausted, report it here:
      // an element that is already in an error state does not re-fire it.
      if (audio.error) {
        if (candidateIndex >= candidates.length - 1) {
          wantPlaying = false;
          setPlayingUI(false);
          notifyPlaybackError();
        }
        return;
      }

      wantPlaying = false;
      notifyPlaybackError();
    }
  }

  function applyVolume(value: number) {
    const percent = Math.min(100, Math.max(0, value));
    audio.volume = percent / 100;
    volume.value = String(percent);
    volume.style.background = `linear-gradient(90deg, var(--color-crimson) ${percent}%, #332b35 ${percent}%)`;
    volume.setAttribute("aria-valuetext", `${Math.round(percent)}%`);
  }

  function applySource() {
    const source = candidates[candidateIndex];

    if (!source) {
      wantPlaying = false;
      setPlayingUI(false);
      notifyPlaybackError();
      return;
    }

    errorNotified = false;
    audio.src = source.src;
    audio.load();
  }

  function loadTrack(nextIndex: number, autoplay: boolean) {
    trackIndex =
      ((nextIndex % tracks.length) + tracks.length) % tracks.length;

    const track = tracks[trackIndex];
    renderTrackMeta(track);

    candidates = orderSources(track);
    candidateIndex = 0;
    applySource();

    if (autoplay) {
      void startPlayback(true);
    } else {
      wantPlaying = false;
      setPlayingUI(false);
    }

    renderProgress();
  }

  audio.addEventListener("play", () => {
    wantPlaying = true;
    setPlayingUI(true);
  });

  audio.addEventListener("pause", () => {
    setPlayingUI(false);
  });

  audio.addEventListener("loadedmetadata", () => {
    renderProgress();
  });

  audio.addEventListener("durationchange", () => {
    renderProgress();
  });

  audio.addEventListener("timeupdate", () => {
    if (isSeeking) return;
    renderProgress();
  });

  audio.addEventListener("ended", () => {
    // Wrap around and keep the soundtrack going for as long as the page lives.
    loadTrack(trackIndex + 1, true);
  });

  audio.addEventListener("error", () => {
    if (candidateIndex < candidates.length - 1) {
      candidateIndex += 1;
      applySource();
      if (wantPlaying) void startPlayback(false);
      return;
    }

    wantPlaying = false;
    setPlayingUI(false);
    notifyPlaybackError();
  });

  playBtn.addEventListener("click", () => {
    hasInteracted = true;

    if (audio.paused) {
      void startPlayback(true);
      return;
    }

    wantPlaying = false;
    audio.pause();
    toast.info("Musica en pausa", {
      description: "Si lees esto, te amoooooo",
    });
  });

  prevBtn.addEventListener("click", () => {
    hasInteracted = true;
    const autoplay = wantPlaying || !audio.paused;
    loadTrack(trackIndex - 1, autoplay);
  });

  nextBtn.addEventListener("click", () => {
    hasInteracted = true;
    const autoplay = wantPlaying || !audio.paused;
    loadTrack(trackIndex + 1, autoplay);
  });

  seek.addEventListener("pointerdown", () => {
    isSeeking = true;
  });

  seek.addEventListener("pointerup", () => {
    isSeeking = false;
    renderProgress();
  });

  seek.addEventListener("pointercancel", () => {
    isSeeking = false;
    renderProgress();
  });

  seek.addEventListener("input", () => {
    hasInteracted = true;

    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;

    audio.currentTime = Number(seek.value);
    renderProgress(false);
  });

  seek.addEventListener("change", () => {
    isSeeking = false;
    renderProgress();
  });

  volume.addEventListener("input", () => {
    hasInteracted = true;
    applyVolume(Number(volume.value));
  });

  setPlayingUI(false);
  applyVolume(DEFAULT_VOLUME);
  loadTrack(0, false);
}

export function initSoundtrackPlayers() {
  document
    .querySelectorAll<HTMLElement>("[data-soundtrack]")
    .forEach(initSoundtrackPlayer);
}
