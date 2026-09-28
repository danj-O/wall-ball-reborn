# Phase 2B — Fullscreen and mobile game surface

## Changes

- The document and app fill the dynamic viewport and cannot scroll. The arena uses the display area below a fixed top bar; the information and editor panel opens over the arena. The renderer and camera fit update on container resize, viewport changes, and fullscreen changes.
- The Fullscreen button requests or exits fullscreen from a click, reflects `fullscreenchange`, and is disabled with an explanation when the API is unavailable. The browser viewport remains a playable fallback.
- Safe-area insets position the top bar and four touch-control corners away from cutouts. A portrait viewport at phone/tablet width shows a rotate-device prompt; landscape hides it automatically.
- The game surface suppresses selection, tap highlighting, callouts, drag start, context menus, panning, and overscroll. Pointer Events and `touch-action: none` are the primary gesture controls; a non-passive touch-move cancellation helps browsers that still dispatch touch gestures.
- Each joystick retains its pointer ID and pointer capture. `pointercancel`, lost capture, blur, visibility loss, fullscreen change, menu opening, and editor entry clear active movement and aim. UI panels sit above the canvas and cannot pass touches through to it.

## Verification

- `npm test`: 16 passing tests, including independent four-pointer tracking and existing CTF, wall, bomb, and camera behavior.
- `npm run build`: TypeScript and Vite production build passed. There is no separate lint script in this project.
- In the browser, Fullscreen entered and exited through its button, and the arena reframed at the new size. At 390 × 844, the portrait prompt appeared; at 844 × 390, it cleared and the arena fitted below the top bar. The measured document scroll size matched the viewport. `touch-action` and text selection computed to `none` on the arena. Right-click on the canvas produced no context menu. Customize Arena opened its tools and wall selection still worked.

## Browser limits

Some Safari/iPadOS versions restrict the Fullscreen API for ordinary page elements. In those cases the browser viewport remains usable, and the menu offers Home Screen launch guidance. System edge gestures, the home indicator, browser chrome, and OS-level interruptions cannot be reliably suppressed by a normal web page. The app cancels active pointers when the browser reports cancellation, lost capture, blur, or visibility loss. Physical four-finger play and Safari behavior still need device testing.

## Menu and mobile display follow-up

- Replaced the persistent top toolbar with a centered Menu tab. A game-style panel contains touch controls, Customize Arena, Reset Match, fullscreen/display options, rules, and inventory. Opening it cancels active joystick touches; closing it restores play.
- Customize Arena now uses a compact dock outside the menu, leaving the arena available for selecting and dragging walls.
- The fullscreen action is no longer disabled on browsers without the API. It becomes **Display Options** and explains the Home Screen launch route. The project now includes a web app manifest, 192px and 512px icons, and Apple web app metadata. Installed launches request fullscreen landscape presentation where the platform honors it.
- Browser inspection confirmed the menu, touch controls, and editor dock at both desktop and short landscape sizes. Build and the existing tests remain green. The Home Screen launch route still requires testing on the target phone or tablet.

WebKit documents that Home Screen apps with a `standalone` or `fullscreen` manifest display mode open separately from Safari: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/. This does not grant a normal Safari tab the Fullscreen API.
