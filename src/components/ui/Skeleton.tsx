/** Skeleton primitives for loading states (used by route-level loading.tsx). */
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded-md bg-border/60 ${className}`} style={style} />;
}

export function SkeletonCard() {
  return (
    <div className="card">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-20" />
      <Skeleton className="mt-2 h-3 w-28" />
    </div>
  );
}

export function SkeletonStatGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** A full page skeleton — header + stat grid + two chart blocks. */
export function PageSkeleton() {
  return (
    <div>
      <Skeleton className="h-6 w-64" />
      <Skeleton className="mt-2 h-4 w-80" />
      <div className="mt-6">
        <SkeletonStatGrid />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-3 h-40 w-full" />
        </div>
        <div className="card">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-3 h-40 w-full" />
        </div>
      </div>
    </div>
  );
}
