import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 text-sm font-medium whitespace-nowrap transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer active:scale-[0.97]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:brightness-110 rounded-md shadow-[0_1px_2px_oklch(0/0/0/0.3)]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md",
        outline:
          "border border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/20 hover:bg-surface rounded-md",
        ghost: "text-muted-foreground hover:text-foreground hover:bg-surface rounded-md",
        success:
          "bg-success text-success-foreground hover:brightness-110 rounded-md shadow-[0_1px_2px_oklch(0/0/0/0.3)]",
        destructive:
          "bg-destructive text-destructive-foreground hover:brightness-110 rounded-md shadow-[0_1px_2px_oklch(0/0/0/0.3)]",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-7 px-3 text-xs",
        lg: "h-10 px-5 text-sm",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
