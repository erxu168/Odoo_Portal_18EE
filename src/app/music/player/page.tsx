import type { Metadata } from 'next';
import MusicPlayerApp from '@/components/music/MusicPlayerApp';

export const metadata: Metadata = {
  title: 'WAJ Radio',
  description: 'What A Jerk jukebox player',
  // Installing THIS page from Chrome (signed into the Premium account) is the
  // app form on the Sunmi — fullscreen, landscape, ad-free (spec §2a).
  manifest: '/waj-radio.webmanifest',
};

// The kiosk screen on the speakers tablet. Access is enforced by the player
// APIs (device pin) — the page itself renders a friendly explainer when this
// device isn't the assigned player.
export default function MusicPlayerPage() {
  return <MusicPlayerApp />;
}
