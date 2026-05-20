"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const LINES = ["Extracting walls", "Identifying rooms", "Measuring areas"];
const PER_LINE_MS = 2667; // 3 × 2.667s ≈ 8s end-to-end

export function ParseLoading() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setActive((i) => (i + 1) % LINES.length);
    }, PER_LINE_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="flex min-h-[60vh] items-center justify-center rounded-xl border border-ink-100 bg-surface-container-low p-3xl">
      <div className="flex flex-col items-center gap-lg text-center">
        <div className="flex flex-col items-center gap-md">
          {LINES.map((line, i) => (
            <div key={line} className="relative">
              <p
                className="font-display text-[28px] italic leading-tight transition-colors duration-300"
                style={{
                  color: i === active ? "#0F1B2D" : "#4F4539",
                  opacity: i === active ? 1 : 0.45,
                }}
              >
                {line}
              </p>
              {i === active && (
                <motion.span
                  key={`${line}-bar-${active}`}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: PER_LINE_MS / 1000, ease: "linear" }}
                  style={{
                    transformOrigin: "left center",
                    background: "#A4793A",
                  }}
                  className="absolute -bottom-1 left-0 h-[2px] w-full"
                  aria-hidden="true"
                />
              )}
            </div>
          ))}
        </div>
        <p className="label-caps text-ink-500">
          This takes about 8 seconds
        </p>
      </div>
    </section>
  );
}
