import React from 'react';
export interface CardProps {
    /** Card title */
    title?: string;
    /** Card subtitle */
    subtitle?: string;
    /** Card children */
    children?: React.ReactNode;
    /** Additional actions or content in the header */
    headerActions?: React.ReactNode;
    /** Additional CSS classes */
    className?: string;
    /** Clickable card */
    onClick?: () => void;
    /** Hover effect */
    hover?: boolean;
}
/**
 * Theme-aware Card component
 *
 * @example
 * <Card title="My Item" subtitle="Description">
 *   <p>Card content here</p>
 * </Card>
 */
export declare function Card({ title, subtitle, children, headerActions, className, onClick, hover }: CardProps): import("react/jsx-runtime").JSX.Element;
