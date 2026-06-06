/**
 * Persistent "Now Playing" mini-player (bottom-right).
 *
 * Rendered once in Layout so it stays mounted across route changes; the audio
 * itself lives in the module-scoped store (store/musicPreview) so playback is
 * never interrupted by navigation. Shows nothing until a preview is started.
 */
import { Play, Pause, X, Volume2, VolumeX } from "lucide-react";
import { DiscIcon } from "@/components/DiscIcon";
import { useMusicPreviewStore } from "@/store/musicPreview";

function fmt(secs: number): string {
  if (!isFinite(secs) || secs < 0) secs = 0;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function NowPlayingWidget() {
  const { track, playing, currentTime, duration, volume, toggle, seek, setVolume, stop } =
    useMusicPreviewStore();

  if (!track) return null;

  const total = duration || track.durationSecs || 0;

  return (
    <div
      role="region"
      aria-label="Now playing"
      className="fixed right-4 bottom-20 md:bottom-4 z-40 w-72
                 rounded-2xl border border-[#D9D5D0] dark:border-[#363944]
                 bg-white/95 dark:bg-[#1C1E27]/95 backdrop-blur-sm shadow-2xl
                 p-3 animate-[modal-in_150ms_ease]"
    >
      {/* Header: art + title + close */}
      <div className="flex items-center gap-3">
        <DiscIcon
          soundId={track.id}
          imageUrl={track.imageUrl}
          size={40}
          label={track.title}
          className={playing ? "animate-[spin_4s_linear_infinite]" : ""}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] truncate">
            {track.title}
          </p>
          <p className="text-[11px] text-meta truncate">{track.artist || "Preview"}</p>
        </div>
        <button
          onClick={stop}
          aria-label="Close player"
          className="p-1 rounded-lg text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0]
                     hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>

      {/* Seek bar */}
      <div className="mt-3">
        <input
          type="range"
          min={0}
          max={Math.max(total, 0.1)}
          step={0.1}
          value={Math.min(currentTime, total || currentTime)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
          className="w-full h-1 accent-[#5B9BF0] cursor-pointer"
        />
        <div className="flex justify-between text-[10px] text-meta tabular-nums mt-0.5">
          <span>{fmt(currentTime)}</span>
          <span>{fmt(total)}</span>
        </div>
      </div>

      {/* Controls: play/pause + volume */}
      <div className="flex items-center gap-3 mt-1">
        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="w-9 h-9 rounded-full bg-[#5B9BF0] text-white flex items-center justify-center
                     hover:bg-[#4A8ADF] transition-colors flex-shrink-0"
        >
          {playing
            ? <Pause className="w-4 h-4" aria-hidden />
            : <Play className="w-4 h-4 translate-x-[1px]" aria-hidden />}
        </button>

        <button
          onClick={() => setVolume(volume > 0 ? 0 : 1)}
          aria-label={volume > 0 ? "Mute" : "Unmute"}
          className="text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0] flex-shrink-0"
        >
          {volume > 0
            ? <Volume2 className="w-4 h-4" aria-hidden />
            : <VolumeX className="w-4 h-4" aria-hidden />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Volume"
          className="flex-1 h-1 accent-[#5B9BF0] cursor-pointer"
        />
      </div>
    </div>
  );
}
