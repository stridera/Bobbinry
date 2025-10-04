import React from 'react';
export interface PanelProps {
    /** Panel title */
    title?: string;
    /** Panel children */
    children: React.ReactNode;
    /** Additional CSS classes */
    className?: string;
    /** Collapsible panel */
    collapsible?: boolean;
    /** Initially collapsed (only if collapsible) */
    defaultCollapsed?: boolean;
}
/**
 * Theme-aware Panel component for sidebars and sections
 *
 * @example
 * <Panel title="Statistics">
 *   <div>Panel content</div>
 * </Panel>
 */
export declare function Panel({ title, children, className, collapsible, defaultCollapsed }: PanelProps): import("react/jsx-runtime").JSX.Element;
