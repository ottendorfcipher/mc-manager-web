/**
 * Global in-browser music-preview player.
 *
 * The <audio> element lives at MODULE scope (not inside any component) so
 * playback survives route/tab changes — navigating away from the Music page
 * keeps the preview going. A small persistent "Now Playing" widget
 * (components/NowPlayingWidget) reads this store and renders the controls.
 *
 * Only custom (uploaded .ogg) tracks are previewable in the browser; vanilla
 * disc sounds only exist in-game.
 */
import { create } from "zustand";

export interface PreviewTrack {
  id:           string;          // sound id, e.g. "rsc:custom.<uuid>"
  title:        string;
  artist:       string;
  imageUrl:     string | null;
  durationSecs: number;
}

interface MusicPreviewState {
  track:       PreviewTrack | null;
  playing:     boolean;
  currentTime: number;
  duration:    number;           // seconds (from audio metadata, falls back to track)
  volume:      number;           // 0..1
  /** Start a track (or toggle play/pause if it's already the current one). */
  play:    (track: PreviewTrack) => void;
  toggle:  () => void;
  seek:    (seconds: number) => void;
  setVolume: (v: number) => void;
  stop:    () => void;           // stop + dismiss the widget
}

export const useMusicPreviewStore = create<MusicPreviewState>((set, get) => {
  // Lazily-created singleton audio element. Created on first play() so we never
  // construct it for users who never preview anything.
  let audio: HTMLAudioElement | null = null;

  function el(): HTMLAudioElement {
    if (audio) return audio;
    const a = new Audio();
    a.preload = "metadata";
    a.addEventListener("play",  () => set({ playing: true }));
    a.addEventListener("pause", () => set({ playing: false }));
    a.addEventListener("timeupdate", () => set({ currentTime: a.currentTime }));
    a.addEventListener("loadedmetadata", () =>
      set({ duration: isFinite(a.duration) ? a.duration : get().track?.durationSecs ?? 0 }));
    a.addEventListener("ended", () => set({ playing: false, currentTime: 0 }));
    a.addEventListener("error", () => set({ playing: false }));
    audio = a;
    return a;
  }

  return {
    track: null,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,

    play: (track) => {
      const a = el();
      if (get().track?.id === track.id) {
        if (a.paused) a.play().catch(() => {});
        else          a.pause();
        return;
      }
      a.src = `/api/music/tracks/${encodeURIComponent(track.id)}/preview`;
      a.currentTime = 0;
      a.volume = get().volume;
      a.play().catch(() => {});
      set({ track, playing: true, currentTime: 0, duration: track.durationSecs || 0 });
    },

    toggle: () => {
      const a = el();
      if (!get().track) return;
      if (a.paused) a.play().catch(() => {});
      else          a.pause();
    },

    seek: (seconds) => {
      const a = el();
      const d = a.duration && isFinite(a.duration) ? a.duration : get().duration;
      const t = Math.max(0, Math.min(seconds, d || seconds));
      a.currentTime = t;
      set({ currentTime: t });
    },

    setVolume: (v) => {
      const a = el();
      const vol = Math.max(0, Math.min(1, v));
      a.volume = vol;
      set({ volume: vol });
    },

    stop: () => {
      const a = el();
      a.pause();
      a.removeAttribute("src");
      a.load();
      set({ track: null, playing: false, currentTime: 0, duration: 0 });
    },
  };
});
