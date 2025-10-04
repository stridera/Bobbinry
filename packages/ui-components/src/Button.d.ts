import React from 'react';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Visual style variant */
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    /** Size of the button */
    size?: 'sm' | 'md' | 'lg';
    /** Full width button */
    fullWidth?: boolean;
    /** Loading state */
    loading?: boolean;
}
/**
 * Theme-aware Button component
 *
 * @example
 * <Button variant="primary" onClick={handleClick}>
 *   Save
 * </Button>
 */
export declare function Button({ variant, size, fullWidth, loading, disabled, className, children, ...props }: ButtonProps): import("react/jsx-runtime").JSX.Element;
