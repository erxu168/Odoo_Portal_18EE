---
name: Immersive View Design Rules
description: User preferences for immersive cooking/production guide screens — no distractions, no nav chrome
type: feedback
---

Immersive recipe screens (cooking board, cook mode, step views, recording) must be completely free of navigation chrome — no hamburger bar, no bottom tab bar, no home button.

**Why:** The user explicitly wants these screens "easy to read and free from any distractions." Kitchen staff using these during cooking should see only the recipe content.

**How to apply:** Use TopBarContext to hide both AppTopBar and AppTabBar. The `TOPBAR_SCREENS` set in recipes/page.tsx controls which screens are non-immersive (dashboard, settings, stats, approvals). Everything else in the recipe module is immersive. Home button should only appear on non-immersive screens.
