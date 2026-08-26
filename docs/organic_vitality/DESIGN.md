---
name: Organic Vitality
colors:
  surface: '#f8faf5'
  surface-dim: '#d9dbd6'
  surface-bright: '#f8faf5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f0'
  surface-container: '#edeeea'
  surface-container-high: '#e7e9e4'
  surface-container-highest: '#e1e3df'
  on-surface: '#191c1a'
  on-surface-variant: '#42493e'
  inverse-surface: '#2e312e'
  inverse-on-surface: '#f0f1ed'
  outline: '#72796e'
  outline-variant: '#c2c9bb'
  surface-tint: '#3b6934'
  primary: '#154212'
  on-primary: '#ffffff'
  primary-container: '#2d5a27'
  on-primary-container: '#9dd090'
  inverse-primary: '#a1d494'
  secondary: '#805533'
  on-secondary: '#ffffff'
  secondary-container: '#fdc39a'
  on-secondary-container: '#794e2e'
  tertiary: '#3a3934'
  on-tertiary: '#ffffff'
  tertiary-container: '#51504a'
  on-tertiary-container: '#c5c2bb'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#bcf0ae'
  primary-fixed-dim: '#a1d494'
  on-primary-fixed: '#002201'
  on-primary-fixed-variant: '#23501e'
  secondary-fixed: '#ffdcc5'
  secondary-fixed-dim: '#f4bb92'
  on-secondary-fixed: '#301400'
  on-secondary-fixed-variant: '#653d1e'
  tertiary-fixed: '#e5e2da'
  tertiary-fixed-dim: '#c9c6bf'
  on-tertiary-fixed: '#1c1c17'
  on-tertiary-fixed-variant: '#474741'
  background: '#f8faf5'
  on-background: '#191c1a'
  surface-variant: '#e1e3df'
  status-free: '#4CAF50'
  status-occupied: '#FF9800'
  status-reserved: '#2196F3'
  status-urgent: '#D32F2F'
  status-preparing: '#FFC107'
  surface-cream: '#FDFCF8'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-margin: 24px
  gutter: 16px
  component-padding-sm: 8px 12px
  component-padding-md: 12px 20px
  component-padding-lg: 16px 24px
---

## Brand & Style

The design system for "Tiệm Của Lá" is rooted in the concept of **Organic Vitality**. It bridges the gap between a serene, nature-inspired lifestyle brand and a high-performance operational tool. The personality is professional, dependable, and refreshing—designed to reduce the cognitive load and stress levels of busy F&B staff while providing a welcoming, airy experience for customers.

The visual direction follows a **Corporate / Modern** aesthetic with **Minimalist** sensibilities. It prioritizes clarity and functional density. By utilizing a "Leaf Green" primary palette against soft cream surfaces, the UI evokes a sense of freshness and cleanliness, essential for food and beverage environments. The interface avoids unnecessary clutter, using generous whitespace and a "Safe" visual identity to ensure that status indicators and call-to-actions are unmistakable even in high-glare or fast-paced settings.

## Colors

The palette is anchored by **Leaf Green**, a deep, trustworthy green that represents growth and natural quality. **Earth Brown** is used sparingly for accents and secondary actions, grounding the design with a stable, artisanal feel. 

The background strategy utilizes **Soft Cream** instead of pure white to reduce eye strain during long shifts and to reinforce the organic brand narrative. Semantic colors are critical for the POS functionality:
- **Success/Available (Free):** A vibrant grass green.
- **Warning/Busy (Occupied):** A warm amber.
- **Info/Action (Reserved):** A clear sky blue.
- **Danger (Overdue/Urgent):** A sharp, high-visibility red.

Neutral tones are slightly desaturated greens/grays to maintain harmony with the primary brand color, ensuring that text remains highly legible without the harshness of pure black-on-white.

## Typography

This design system uses a dual-font strategy to balance character with utility. 
- **Plus Jakarta Sans** is the headline face. Its soft, rounded terminals feel welcoming and optimistic, perfect for brand-heavy areas like shop names, category titles, and key KPI displays.
- **Inter** handles the heavy lifting of the functional UI. It is chosen for its exceptional legibility in data-dense environments, such as order lists, ingredient modifiers, and admin tables.

Large display sizes use tighter letter-spacing for a modern, "tucked" look, while labels and captions use slightly increased tracking to ensure clarity at small scales, particularly for metadata like Order IDs or timestamps.

## Layout & Spacing

The layout philosophy follows a **Fluid Grid** system based on an 8px spacing scale. This ensures a consistent rhythm across the POS dashboard and customer-facing menus.

- **Desktop (Admin/POS):** A 12-column grid is used for the dashboard. The left sidebar is typically fixed (240px-280px), while the main content area expands.
- **Tablets (POS Primary):** Elements reflow into a 2-column split: the "Menu Selection" area (left) and the "Order Summary" sidebar (right). This ensures that the most common interactions are within easy thumb-reach.
- **Mobile (Customer Order):** A single-column flow with 16px margins. Product cards use a 2-column masonry or grid layout to maximize vertical space.

Gutters are kept at a standard 16px to maintain a breathable interface, even when displaying complex data visualizations or dense table maps.

## Elevation & Depth

To maintain a clean, "Safe" aesthetic, this design system uses **Tonal Layers** supplemented by **Ambient Shadows**. Instead of heavy shadows, we use surface color variations to indicate hierarchy:

1.  **Level 0 (Base):** The main background using `surface-cream`.
2.  **Level 1 (Cards/Sidebar):** Pure white surfaces with a very soft, diffused shadow (4px blur, 4% opacity, tinted with primary green) to create a subtle lift.
3.  **Level 2 (Modals/Pop-overs):** Higher elevation with an 8px-12px blur shadow to draw focus.
4.  **Interactive States:** Elements like buttons use a slight "press" effect (reducing elevation) to provide tactile feedback without traditional skeuomorphism.

Low-contrast outlines (1px, 10% opacity of the neutral color) are used to define boundaries on white surfaces, ensuring a crisp look without visual noise.

## Shapes

The shape language is consistently **Rounded**, utilizing an 8px base radius for standard components. This specific level of roundness was chosen to mirror the organic forms of the brand's namesake (the leaf) while maintaining a professional, structured feel.

- **Buttons & Inputs:** 8px (rounded-md) for a friendly yet precise look.
- **Product Cards:** 16px (rounded-lg) to create a soft, inviting container for imagery.
- **Status Pills:** Fully rounded (pill-shaped) to distinguish them from interactive buttons.
- **Containers/Modals:** 24px (rounded-xl) for large-scale structural elements, providing a modern app-like feel.

## Components

### Buttons
- **Primary:** Solid Leaf Green with white text. High emphasis.
- **Secondary:** Outlined Earth Brown or Leaf Green. Used for secondary actions like "Add Note."
- **Ghost:** No background, primary color text. Used for "Cancel" or less frequent actions.

### Cards
- **Product Card:** Features a top-aligned image with 16px rounded corners, followed by the product name in `headline-sm` and price in `body-md` (bold).
- **Table Card:** A square container using semantic background colors (e.g., light green for Free) with the table number centered in `headline-md`.

### Status Indicators
- **Pills:** Compact, fully rounded tags with a background opacity of 15% and 100% text color (e.g., "Preparing" uses a soft amber background with dark amber text).

### Form Inputs
- **Text Fields:** 1px border using a light neutral tint. On focus, the border transitions to Leaf Green with a 2px thickness.
- **Selection Modifiers:** Used for Ice/Sugar levels; these appear as segmented controls (toggle groups) rather than dropdowns to allow for faster tapping in a POS context.

### Data Visualization
- **Charts:** Use a palette derived from the primary green and secondary brown. Use clean line charts for "Daily Trends" and simplified bar charts for "Hourly Peaks" to ensure quick readability at a glance.