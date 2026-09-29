import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { useFieldId } from "@/components/nocturne/field";

const labelVariants = cva("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70");

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, htmlFor, id, ...props }, ref) => {
  // Dentro de um `Field` o rótulo aponta sozinho para o controle dele, e ganha
  // um id próprio para o controle que não é campo (grupo de botões) apontar
  // de volta com aria-labelledby.
  const fieldId = useFieldId();
  return (
    <LabelPrimitive.Root
      ref={ref}
      htmlFor={htmlFor ?? fieldId}
      id={id ?? (fieldId ? `${fieldId}-label` : undefined)}
      className={cn(labelVariants(), className)}
      {...props}
    />
  );
});
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
