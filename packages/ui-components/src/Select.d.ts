import React from 'react';
export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
}
export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
    /** Label for the select */
    label?: string;
    /** Error message to display */
    error?: string;
    /** Helper text */
    helperText?: string;
    /** Full width select */
    fullWidth?: boolean;
    /** Options to display */
    options: SelectOption[];
    /** Placeholder text when no option is selected */
    placeholder?: string;
}
/**
 * Theme-aware Select component
 *
 * @example
 * <Select
 *   label="Status"
 *   options={[
 *     { value: 'active', label: 'Active' },
 *     { value: 'inactive', label: 'Inactive' }
 *   ]}
 *   placeholder="Select status..."
 * />
 */
export declare function Select({ label, error, helperText, fullWidth, className, id, options, placeholder, ...props }: SelectProps): import("react/jsx-runtime").JSX.Element;
