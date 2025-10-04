import React from 'react';
export interface ToastProps {
    /** Toast message */
    message: string;
    /** Toast variant */
    variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
    /** Duration in milliseconds before auto-dismiss (0 = no auto-dismiss) */
    duration?: number;
    /** Callback when toast is dismissed */
    onDismiss?: () => void;
    /** Show close button */
    dismissible?: boolean;
    /** Additional CSS classes */
    className?: string;
}
/**
 * Theme-aware Toast notification component
 *
 * @example
 * const [showToast, setShowToast] = useState(false)
 *
 * {showToast && (
 *   <Toast
 *     message="Item saved successfully!"
 *     variant="success"
 *     duration={3000}
 *     onDismiss={() => setShowToast(false)}
 *   />
 * )}
 */
export declare function Toast({ message, variant, duration, onDismiss, dismissible, className }: ToastProps): import("react/jsx-runtime").JSX.Element;
/**
 * Toast container for positioning toasts on the screen
 *
 * @example
 * <ToastContainer position="top-right">
 *   {toasts.map(toast => (
 *     <Toast key={toast.id} {...toast} />
 *   ))}
 * </ToastContainer>
 */
export declare function ToastContainer({ children, position, className }: {
    children: React.ReactNode;
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center';
    className?: string;
}): import("react/jsx-runtime").JSX.Element;
