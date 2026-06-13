"use client";

import { motion } from "framer-motion";

export function SignalBar() {
  return (
    <motion.div
      aria-hidden="true"
      className="fixed left-0 top-0 z-50 h-[2px] w-full origin-left bg-gradient-to-r from-[var(--accent-primary)] via-[var(--accent-green)] to-[var(--accent-purple)]"
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ duration: 1.2, ease: [0, 0, 0.2, 1] }}
    />
  );
}
