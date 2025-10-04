import React from 'react';
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    /** Label for the input */
    label?: string;
    /** Error message to display */
    error?: string;
    /** Helper text */
    helperText?: string;
    /** Full width input */
    fullWidth?: boolean;
}
/**
 * Theme-aware Input component
 *
 * @example
 * <Input
 *   label="Email"
 *   type="email"
 *   placeholder="you@example.com"
 *   error={errors.email}
 * />
 */
export declare function Input({ label, error, helperText, fullWidth, className, id, ...props }: InputProps): import("react/jsx-runtime").JSX.Element;
