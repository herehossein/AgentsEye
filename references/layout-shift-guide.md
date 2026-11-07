# Layout Shift vs Intentional Animations (CLS vs Motion)

Modern web applications frequently include rich animations and dynamic motion. A high Cumulative Layout Shift (CLS) score or bounding-box movement reported during inspection does not automatically mean the page has a layout bug.

## Distinguishing Intentional Motion from Real Layout Defects

| Feature / Behavior | Intentional Motion (Expected & Healthy) | Real Layout Shift Bug (Defect to Fix) |
| :--- | :--- | :--- |
| **Marquee Banners & Tickers** | Sponsor logos, news tickers, or announcement bars continuously sliding across the screen. | A banner that suddenly snaps into place after seconds, shifting all page content downward. |
| **CSS Keyframes & Transitions** | Hero fade-ins, accordion expansions, sliding navigation drawers, floating action button pulses. | An image or video without `width`/`height` or `aspect-ratio` that pops into the DOM, displacing text. |
| **Interactive Transforms** | Hover card elevations, tab indicator sliding, toggle switches, carousel item scrolling. | Dynamic ads, widgets, or third-party embeds injected into document flow without placeholder dimensions. |
| **Compositing vs Reflow** | Uses GPU-accelerated CSS `transform: translate*` and `opacity` inside `overflow: hidden` containers. | Uses `top`, `left`, `margin-top`, or `height` animations that force browser layout recalculation every frame. |
| **Font & Text Shifts** | Web fonts using matched fallback metrics or intentional animated typography. | FOUT/FOIT causing entire paragraphs and buttons to violently reflow when web fonts finish downloading. |

## Decision Rules for CLS & Motion

1. **Never Remove or Mutilate Intentional UI Motion**:
   - Classes like `marquee`, `slider`, `carousel`, `ticker`, `animate-*`, `transition-*`, or `motion-*` are clues, not proof of intentional motion. Confirm the intended behavior from trusted source/design requirements and observed behavior.
   - Do not delete animations, disable marquees, or strip interactive transitions solely to lower a CLS score.

2. **When to Fix Layout Shifts (Real Bugs)**:
   - **Missing Image/Media Dimensions**: Add explicit `width`, `height`, or CSS `aspect-ratio` to prevent layout jumps when media loads.
   - **Uncontained Dynamic Injections**: Reserve space for dynamic banners or lazy-loaded components using `min-height` or skeleton placeholders.
   - **Reflow-Heavy Animations**: If a transition animates layout properties (`height`, `top`, `margin`), refactor it to use CSS `transform` (e.g. `transform: translateY(...)`) and `opacity` so that the browser composites on the GPU without triggering document layout shifts.
   - **Scroll-Lock Traps & Overflow**: Ensure animated containers specify `overflow: hidden` or `contain: paint` so movement does not leak outside its boundary or cause horizontal scrollbars.
