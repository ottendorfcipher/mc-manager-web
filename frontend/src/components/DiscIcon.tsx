/**
 * Visual representation of a music track:
 *   • Custom track with image  → renders the uploaded artwork.
 *   • Otherwise               → procedural "music disc" SVG, coloured by
 *                                a stable hash of the sound ID.
 *
 * Used by the Music tab (track rows) and the Events tab (countdown picker).
 */

interface Props {
  /** Sound ID, e.g. `minecraft:music_disc.cat` or `redstonecipher:music.foo`. */
  soundId: string;
  /** Optional uploaded image URL.  Always preferred when present. */
  imageUrl?: string | null;
  /** Pixel size (default 32). */
  size?: number;
  /** Display name (used only for the alt text). */
  label?: string;
  className?: string;
}

/** Hash a string to a hue in [0, 360). */
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function DiscIcon({ soundId, imageUrl, size = 32, label = "", className = "" }: Props) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={label || soundId}
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`}
        loading="lazy"
      />
    );
  }

  const hue = hashHue(soundId);
  const ringColor   = `hsl(${hue}, 65%, 45%)`;
  const ringColor2  = `hsl(${(hue + 30) % 360}, 65%, 35%)`;
  const center      = `hsl(${hue}, 70%, 55%)`;

  // SVG mock of a vinyl-style music disc: outer dark ring, two coloured
  // grooves, and a central label dot.
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-label={label || soundId}
      role="img"
    >
      {/* Outer black ring */}
      <circle cx="16" cy="16" r="15" fill="#1C1E27" />
      {/* Inner coloured layer */}
      <circle cx="16" cy="16" r="13" fill={ringColor} />
      {/* Concentric grooves */}
      <circle cx="16" cy="16" r="11" fill="none" stroke={ringColor2} strokeWidth="0.6" />
      <circle cx="16" cy="16" r="9"  fill="none" stroke={ringColor2} strokeWidth="0.5" opacity="0.7" />
      <circle cx="16" cy="16" r="7"  fill="none" stroke={ringColor2} strokeWidth="0.4" opacity="0.5" />
      {/* Centre label */}
      <circle cx="16" cy="16" r="4" fill={center} />
      {/* Tiny spindle hole */}
      <circle cx="16" cy="16" r="1" fill="#1C1E27" />
    </svg>
  );
}
