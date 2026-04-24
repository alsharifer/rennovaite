export default function Home() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
      style={{ backgroundColor: "#FAF7F2" }}
    >
      <div className="flex flex-1 flex-col items-center justify-center">
        <h1
          className="text-5xl font-semibold tracking-tight sm:text-7xl"
          style={{ color: "#B85042" }}
        >
          RennovAIte
        </h1>
        <p
          className="mt-6 text-lg sm:text-xl"
          style={{ color: "#164E63" }}
        >
          Coming soon to Dubai
        </p>
      </div>
      <footer className="pb-8 pt-16 text-sm text-neutral-500">
        Built in Dubai · From floorplan to finished home in 5 days
      </footer>
    </main>
  );
}
