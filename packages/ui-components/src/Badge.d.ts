import React from 'react';
export interface BadgeProps {
    /** Badge content */
    children: React.ReactNode;
    /** Badge variant */
    variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
    /** Badge size */
    size?: 'sm' | 'md' | 'lg';
    /** Additional CSS classes */
    className?: string;
    /** Show dot indicator */
    dot?: boolean;
}
/**
 * Theme-aware Badge component
 *
 * @example
 * <Badge variant="success">Active</Badge>
 * <Badge variant="danger" size="sm">Error</Badge>
 * <Badge dot>New</Badge>
 */
export declare function Badge({ children, variant, size, className, dot }: BadgeProps): import("react/jsx-runtime").JSX.Element;
