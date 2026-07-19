'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCookTimer } from '@/hooks/useCookTimer';
import { unlockAudio } from '@/lib/cooktimer/sound';
import { stationColorMap } from '@/lib/cooktimer/stationColor';
import CookTimerTopBar from '@/components/cooktimer/CookTimerTopBar';
import CookQueue from '@/components/cooktimer/CookQueue';
import CookTimerCard from '@/components/cooktimer/CookTimerCard';
import CookDoneStrip from '@/components/cooktimer/CookDoneStrip';
import CookSettingsOverlay from '@/components/cooktimer/CookSettingsOverlay';

export default function CookTimerPage() {
  const t = useCookTimer();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Unlock Web Audio on the first user gesture (browser autoplay policy).
  useEffect(() => {
    const unlock = () => unlockAudio();
    document.addEventListener('pointerdown', unlock, { once: true });
    return () => document.removeEventListener('pointerdown', unlock);
  }, []);

  const colorById = useMemo(() => stationColorMap(t.stations), [t.stations]);
  const clockText = new Date(t.nowMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });

  return (
    <div className="ctimer">
      <CookTimerTopBar
        stations={t.stations}
        enabled={t.enabled}
        colorById={colorById}
        clockText={clockText}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {t.error && <div className="ct-errbar">⚠ {t.error}</div>}

      <div className="ct-main">
        <CookQueue queue={t.queue} nowMs={t.nowMs} colorById={colorById} onStart={t.start} />

        <div className="ct-board">
          {t.timers.length === 0 ? (
            <div className="ct-board-empty">No timers running.<br />Tap an item in TO COOK to start it.</div>
          ) : (
            t.timers.map(timer => (
              <CookTimerCard
                key={timer.id}
                timer={timer}
                nowMs={t.nowMs}
                color={colorById[timer.stationId] || '#8fa0b3'}
                onAdvance={t.advance}
                onFinish={t.finish}
                onCancel={t.cancel}
                onMute={t.setMute}
              />
            ))
          )}
        </div>
      </div>

      <CookDoneStrip done={t.done} />

      {t.toast && <div className="ct-toast show">{t.toast}</div>}

      {settingsOpen && (
        <CookSettingsOverlay
          stations={t.stations}
          enabled={t.enabled}
          soundOn={t.soundOn}
          colorById={colorById}
          onToggleStation={t.toggleStation}
          onToggleSound={t.toggleSound}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
