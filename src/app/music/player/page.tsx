import type { Metadata } from 'next';
import MusicPlayerApp from '@/components/music/MusicPlayerApp';

export const metadata: Metadata = {
  title: 'WAJ Radio',
  description: 'What A Jerk jukebox player',
};

// The kiosk screen on the speakers tablet. Access is enforced by the player
// APIs (device pin) — the page itself renders a friendly explainer when this
// device isn't the assigned player.
export default function MusicPlayerPage() {
  return <MusicPlayerApp />;
}
