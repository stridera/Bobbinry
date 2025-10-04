import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
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
export function Textarea({ label, error, helperText, fullWidth = false, autoResize = false, className = '', id, onChange, ...props }) {
    const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-');
    const hasError = Boolean(error);
    const textareaRef = React.useRef(null);
    const baseClasses = 'px-3 py-2 border rounded transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-0 disabled:opacity-50 disabled:cursor-not-allowed resize-vertical';
    const stateClasses = hasError
        ? 'border-red-500 dark:border-red-500 focus:ring-red-500 focus:border-red-500'
        : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500';
    const widthClass = fullWidth ? 'w-full' : '';
    const textareaClasses = [baseClasses, stateClasses, widthClass, className]
        .filter(Boolean)
        .join(' ');
    // Auto-resize functionality
    const handleChange = (e) => {
        if (autoResize && textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
        onChange?.(e);
    };
    // Set initial height for auto-resize
    React.useEffect(() => {
        if (autoResize && textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [autoResize, props.value]);
    return (_jsxs("div", { className: fullWidth ? 'w-full' : '', children: [label && (_jsx("label", { htmlFor: textareaId, className: "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1", children: label })), _jsx("textarea", { ref: textareaRef, id: textareaId, className: textareaClasses, onChange: handleChange, ...props }), (error || helperText) && (_jsx("p", { className: `mt-1 text-sm ${hasError
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-gray-600 dark:text-gray-400'}`, children: error || helperText }))] }));
}
//# sourceMappingURL=Textarea.js.map