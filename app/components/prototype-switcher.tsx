import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, FlaskConical } from "lucide-react";

export interface PrototypeVariantOption {
  key: string;
  label: string;
}

interface PrototypeSwitcherProps {
  variants: PrototypeVariantOption[];
  current: string;
}

export function PrototypeSwitcher({
  variants,
  current,
}: PrototypeSwitcherProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const currentIndex = Math.max(
    0,
    variants.findIndex((v) => v.key === current)
  );
  const activeVariant = variants[currentIndex] ?? variants[0];

  function selectVariant(nextKey: string) {
    const next = new URLSearchParams(searchParams);
    next.set("variant", nextKey);
    setSearchParams(next, { replace: true });
  }

  function cycle(delta: number) {
    const nextIndex =
      (currentIndex + delta + variants.length) % variants.length;
    selectVariant(variants[nextIndex].key);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        cycle(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        cycle(1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div
      data-testid="prototype-switcher"
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2 rounded-full border border-amber-500/40 bg-zinc-950/95 px-3 py-1.5 text-xs text-zinc-100 shadow-2xl backdrop-blur-md"
    >
      <span className="flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-300">
        <FlaskConical className="size-3.5" />
        PROTOTYPE
      </span>

      <button
        type="button"
        onClick={() => cycle(-1)}
        title="Variante anterior (←)"
        className="rounded-full p-1 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
      >
        <ChevronLeft className="size-4" />
      </button>

      <div className="min-w-56 text-center font-medium">
        <span className="text-amber-400 font-bold">{activeVariant.key}</span>
        <span className="mx-1.5 text-zinc-500">·</span>
        <span>{activeVariant.label}</span>
      </div>

      <button
        type="button"
        onClick={() => cycle(1)}
        title="Siguiente variante (→)"
        className="rounded-full p-1 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
      >
        <ChevronRight className="size-4" />
      </button>

      <div className="hidden sm:flex items-center gap-1 border-l border-zinc-800 pl-2">
        {variants.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => selectVariant(v.key)}
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
              v.key === activeVariant.key
                ? "bg-amber-500 text-zinc-950"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            {v.key}
          </button>
        ))}
      </div>
    </div>
  );
}
