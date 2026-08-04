'use client';

/**
 * The official YouTube IFrame player, wrapped once. Rules this component keeps
 * (spec §1a/§6): the iframe stays VISIBLE and unobstructed (min 480×270 pane in
 * the kiosk layout), native controls untouched, `origin` + enablejsapi set, and
 * every ENDED / error event is passed up so the SERVER decides what plays next.
 * The standard youtube.com host is deliberate — the Premium (ad-free) session
 * lives in its cookies; the nocookie host would bring ads back.
 */
import { useEffect, useRef } from 'react';

interface YTPlayer {
  loadVideoById(id: string): void;
  playVideo(): void;
  destroy(): void;
  getVideoData?: () => { video_id?: string };
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: {
    videoId?: string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (e: { target: YTPlayer }) => void;
      onStateChange?: (e: { data: number; target: YTPlayer }) => void;
      onError?: (e: { data: number; target?: YTPlayer }) => void;
      onAutoplayBlocked?: () => void;
    };
  }) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) { resolve(window.YT); return; }
    window.onYouTubeIframeAPIReady = () => { if (window.YT) resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return apiPromise;
}

export default function YouTubeIFramePlayer(props: {
  videoId: string | null;
  /** videoId = the video the PLAYER says emitted the event — ties a delayed event to its track. */
  onEnded: (videoId: string | null) => void;
  onError: (code: number, videoId: string | null) => void;
  onAutoplayBlocked: () => void;
  onPlaying?: () => void;
  /** Receives a function the parent's splash button calls to (re)start playback. */
  registerKick?: (kick: () => void) => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const currentIdRef = useRef<string | null>(null);
  // Callbacks live in refs so the player is created exactly once.
  const cbRef = useRef(props);
  cbRef.current = props;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const YT = await loadApi();
      if (cancelled || !holderRef.current || playerRef.current) return;
      playerRef.current = new YT.Player(holderRef.current, {
        videoId: cbRef.current.videoId ?? undefined,
        playerVars: {
          autoplay: 1, playsinline: 1, rel: 0, enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onStateChange: (e) => {
            const vid = e.target.getVideoData?.()?.video_id ?? currentIdRef.current;
            if (e.data === YT.PlayerState.ENDED) cbRef.current.onEnded(vid ?? null);
            if (e.data === YT.PlayerState.PLAYING) cbRef.current.onPlaying?.();
          },
          onError: (e) => {
            const vid = e.target?.getVideoData?.()?.video_id ?? currentIdRef.current;
            cbRef.current.onError(e.data, vid ?? null);
          },
          onAutoplayBlocked: () => cbRef.current.onAutoplayBlocked(),
        },
      });
      currentIdRef.current = cbRef.current.videoId;
    })();
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
      currentIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!playerRef.current || props.videoId === currentIdRef.current) return;
    currentIdRef.current = props.videoId;
    if (props.videoId) playerRef.current.loadVideoById(props.videoId);
  }, [props.videoId]);

  useEffect(() => {
    props.registerKick?.(() => playerRef.current?.playVideo());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full h-full min-h-[270px]">
      {/* The API replaces this div with the iframe; nothing may overlay it. */}
      <div ref={holderRef} className="absolute inset-0 [&>iframe]:w-full [&>iframe]:h-full" />
    </div>
  );
}
