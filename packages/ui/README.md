# ui

Shared UI components and design system for Bobbinry.

## Purpose

This package contains reusable UI components, design tokens, and styling utilities used across the Bobbinry platform. It provides a consistent design language and component library for the shell, views, and other UI elements.

## Features

- **Design System**: Consistent colors, typography, spacing, and component patterns
- **Reusable Components**: Common UI elements like buttons, forms, modals, etc.
- **Theme Support**: Light/dark mode and customizable themes
- **Accessibility**: WCAG-compliant components with proper ARIA attributes
- **TypeScript**: Full type support for all components and props

## Development

### Setup

```bash
# Install dependencies
pnpm install

# Currently no build step required
# Will be updated when component library is implemented
```

### Project Structure

```
src/
├── components/       # Reusable UI components
│   ├── buttons/
│   ├── forms/
│   ├── layout/
│   ├── navigation/
│   └── feedback/
├── tokens/          # Design tokens (colors, spacing, etc.)
├── themes/          # Theme definitions
├── utils/           # Styling utilities
└── index.ts         # Main exports
```

## Design Tokens

### Colors

```typescript
// tokens/colors.ts
export const colors = {
  primary: {
    50: '#f0f9ff',
    100: '#e0f2fe',
    500: '#0ea5e9',
    900: '#0c4a6e'
  },
  neutral: {
    50: '#fafafa',
    100: '#f5f5f5',
    500: '#737373',
    900: '#171717'
  },
  semantic: {
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6'
  }
};
```

### Typography

```typescript
// tokens/typography.ts
export const typography = {
  fontFamily: {
    sans: ['Inter', 'system-ui', 'sans-serif'],
    serif: ['Merriweather', 'Georgia', 'serif'],
    mono: ['JetBrains Mono', 'Consolas', 'monospace']
  },
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem'
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700'
  }
};
```

### Spacing

```typescript
// tokens/spacing.ts
export const spacing = {
  0: '0',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem'
};
```

## Components (Planned)

### Buttons

```typescript
import { Button } from 'ui/components';

// Basic button
<Button variant="primary" size="md">
  Click me
</Button>

// Button with icon
<Button variant="secondary" icon="plus">
  Add Item
</Button>

// Loading state
<Button loading disabled>
  Saving...
</Button>
```

### Forms

```typescript
import { Input, Select, Checkbox } from 'ui/components';

// Text input
<Input 
  label="Title"
  placeholder="Enter title"
  error="Title is required"
/>

// Select dropdown
<Select
  label="Category"
  options={[
    { value: 'fiction', label: 'Fiction' },
    { value: 'non-fiction', label: 'Non-Fiction' }
  ]}
/>

// Checkbox
<Checkbox 
  label="Published"
  checked={isPublished}
  onChange={setIsPublished}
/>
```

### Layout

```typescript
import { Container, Grid, Stack } from 'ui/components';

// Container with max width
<Container size="lg">
  Content here
</Container>

// Grid layout
<Grid cols={3} gap={4}>
  <div>Column 1</div>
  <div>Column 2</div>
  <div>Column 3</div>
</Grid>

// Vertical stack
<Stack spacing={4}>
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
</Stack>
```

### Navigation

```typescript
import { Tabs, Breadcrumb } from 'ui/components';

// Tab navigation
<Tabs defaultValue="outline">
  <Tabs.List>
    <Tabs.Tab value="outline">Outline</Tabs.Tab>
    <Tabs.Tab value="editor">Editor</Tabs.Tab>
    <Tabs.Tab value="preview">Preview</Tabs.Tab>
  </Tabs.List>
  <Tabs.Content value="outline">
    Outline content
  </Tabs.Content>
</Tabs>

// Breadcrumb navigation
<Breadcrumb>
  <Breadcrumb.Item href="/projects">Projects</Breadcrumb.Item>
  <Breadcrumb.Item href="/projects/novel">My Novel</Breadcrumb.Item>
  <Breadcrumb.Item>Chapter 1</Breadcrumb.Item>
</Breadcrumb>
```

## Theming

### Theme Structure

```typescript
// themes/default.ts
export const defaultTheme = {
  colors: {
    background: colors.neutral[50],
    foreground: colors.neutral[900],
    primary: colors.primary[500],
    secondary: colors.neutral[500],
    border: colors.neutral[200],
    input: colors.neutral[100],
    ring: colors.primary[500]
  },
  spacing,
  typography,
  borderRadius: {
    none: '0',
    sm: '0.125rem',
    md: '0.375rem',
    lg: '0.5rem',
    full: '9999px'
  },
  shadows: {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)'
  }
};
```

### Dark Theme

```typescript
// themes/dark.ts
export const darkTheme = {
  ...defaultTheme,
  colors: {
    background: colors.neutral[900],
    foreground: colors.neutral[50],
    primary: colors.primary[400],
    secondary: colors.neutral[400],
    border: colors.neutral[800],
    input: colors.neutral[800],
    ring: colors.primary[400]
  }
};
```

## Usage

### Installing Components

```typescript
// In your application
import { Button, Input, Theme } from 'ui';
import { defaultTheme } from 'ui/themes';

function App() {
  return (
    <Theme theme={defaultTheme}>
      <Button variant="primary">
        Hello World
      </Button>
    </Theme>
  );
}
```

### Custom Styling

```typescript
// Using design tokens directly
import { colors, spacing } from 'ui/tokens';

const customStyles = {
  backgroundColor: colors.primary[500],
  padding: `${spacing[4]} ${spacing[6]}`,
  borderRadius: '0.375rem'
};
```

## Integration

This package will be used by:
- **Shell**: For all shell UI components and layout
- **Views**: For consistent component styling across views
- **Documentation**: For component showcase and design system docs

## Accessibility

All components follow accessibility best practices:
- **Keyboard Navigation**: Full keyboard support for all interactive elements
- **Screen Readers**: Proper ARIA labels and descriptions
- **Color Contrast**: WCAG AA compliant color combinations
- **Focus Management**: Clear focus indicators and logical tab order

## Contributing

1. Follow the existing design token structure
2. Ensure all components are accessible (WCAG AA)
3. Add TypeScript interfaces for all component props
4. Include both light and dark theme support
5. Write comprehensive component documentation
6. Test components across different screen sizes

## Roadmap

### Phase 1 (Current)
- [ ] Set up component library structure
- [ ] Define complete design token system
- [ ] Create base theme definitions

### Phase 2
- [ ] Implement core components (Button, Input, Select)
- [ ] Add layout components (Container, Grid, Stack)
- [ ] Create navigation components (Tabs, Breadcrumb)

### Phase 3
- [ ] Advanced components (Modal, Dropdown, Tooltip)
- [ ] Form validation and error handling
- [ ] Animation and transition utilities
- [ ] Component documentation site