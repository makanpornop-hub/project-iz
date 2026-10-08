export default function BlankLoading() {
  return (
    <div
      role="status"
      aria-label="Загрузка"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        background: "#fff",
      }}
    />
  );
}
