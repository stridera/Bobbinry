import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Theme-aware Badge component
 *
 * @example
 * <Badge variant="success">Active</Badge>
 * <Badge variant="danger" size="sm">Error</Badge>
 * <Badge dot>New</Badge>
 */
export function Badge({ children, variant = 'default', size = 'md', className = '', dot = false }) {
    const baseClasses = 'inline-flex items-center gap-1 font-medium rounded-full transition-colors';
    const variantClasses = {
        default: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
        primary: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
        success: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
        warning: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
        danger: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
        info: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300'
    };
    const sizeClasses = {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-2.5 py-1 text-sm',
        lg: 'px-3 py-1.5 text-base'
    };
    const dotClasses = {
        default: 'bg-gray-500',
        primary: 'bg-blue-500',
        success: 'bg-green-500',
        warning: 'bg-yellow-500',
        danger: 'bg-red-500',
        info: 'bg-cyan-500'
    };
    const badgeClasses = [
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        className
    ]
        .filter(Boolean)
        .join(' ');
    return (_jsxs("span", { className: badgeClasses, children: [dot && (_jsx("span", { className: `w-1.5 h-1.5 rounded-full ${dotClasses[variant]}`, "aria-hidden": "true" })), children] }));
}
//# sourceMappingURL=Badge.js.map