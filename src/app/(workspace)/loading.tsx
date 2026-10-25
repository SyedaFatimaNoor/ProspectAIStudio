export default function Loading() {
  return (
    <div className="loading-page" role="status" aria-label="Loading workspace">
      <div className="loading-line" />
      <div className="loading-line loading-short" />
      <div className="loading-hero" />
      <div className="loading-cards">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} />
        ))}
      </div>
    </div>
  );
}
