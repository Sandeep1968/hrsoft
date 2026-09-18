"use client";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Label + control wrapper used across the Core HR forms. */
export function Field({ label, hint, className, children, required }: { label: string; hint?: string; className?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label className="text-xs text-muted-foreground">
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const GENDER_OPTIONS = [
  ["UNDISCLOSED", "Prefer not to say"],
  ["MALE", "Male"],
  ["FEMALE", "Female"],
  ["OTHER", "Other"],
] as const;
export const EMPLOYMENT_OPTIONS = [
  ["FULL_TIME", "Full time"],
  ["PART_TIME", "Part time"],
  ["CONTRACT", "Contract"],
  ["INTERN", "Intern"],
  ["CONSULTANT", "Consultant"],
] as const;
export const DOC_TYPE_OPTIONS = [
  ["ID_PROOF", "ID proof"],
  ["ADDRESS_PROOF", "Address proof"],
  ["PAN", "PAN card"],
  ["AADHAAR", "Aadhaar"],
  ["OFFER_LETTER", "Offer letter"],
  ["APPOINTMENT_LETTER", "Appointment letter"],
  ["EDUCATION", "Education certificate"],
  ["EXPERIENCE", "Experience letter"],
  ["CONTRACT", "Contract"],
  ["POLICY_ACK", "Policy acknowledgement"],
  ["OTHER", "Other"],
] as const;
