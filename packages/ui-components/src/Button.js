import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Theme-aware Button component
 *
 * @example
 * <Button variant="primary" onClick={handleClick}>
 *   Save
 * </Button>
 */
export function Button({ variant = 'primary', size = 'md', fullWidth = false, loading = false, disabled, className = '', children, ...props }) {
    const baseClasses = 'inline-flex items-center justify-center font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
    const variantClasses = {
        primary: 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white focus:ring-blue-500',
        secondary: 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 focus:ring-gray-500',
        danger: 'bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 text-white focus:ring-red-500',
        ghost: 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 focus:ring-gray-500'
    };
    const sizeClasses = {
        sm: 'px-3 py-1.5 text-sm',
        md: 'px-4 py-2 text-base',
        lg: 'px-6 py-3 text-lg'
    };
    const widthClass = fullWidth ? 'w-full' : '';
    const classes = [
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        widthClass,
        className
    ].filter(Boolean).join(' ');
    return (_jsxs("button", { className: classes, disabled: disabled || loading, ...props, children: [loading && (_jsxs("svg", { className: "animate-spin -ml-1 mr-2 h-4 w-4", xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", children: [_jsx("circle", { className: "opacity-25", cx: "12", cy: "12", r: "10", stroke: "currentColor", strokeWidth: "4" }), _jsx("path", { className: "opacity-75", fill: "currentColor", d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" })] })), children] }));
}
//# sourceMappingURL=Button.js.map