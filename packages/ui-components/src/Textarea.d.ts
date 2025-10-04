import React from 'react';
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    /** Label for the textarea */
    label?: string;
    /** Error message to display */
    error?: string;
    /** Helper text */
    helperText?: string;
    /** Full width textarea */
    fullWidth?: boolean;
    /** Auto-resize based on content */
    autoResize?: boolean;
}
/**
 * Theme-aware Textarea component
 *
 * @example
 * <Textarea
 *   label="Description"
 *   placeholder="Enter description..."
 *   rows={4}
 *   fullWidth
 * />
 */
export declare function Textarea({ label, error, helperText, fullWidth, autoResize, className, id, onChange, ...props }: TextareaProps): import("react/jsx-runtime").JSX.Element;
