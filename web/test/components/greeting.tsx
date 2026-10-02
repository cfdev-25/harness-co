/** A trivial component that exists only to prove the rig can mount a real
    component and read its DOM (01 D62, 02 rule 30). */
export function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}</p>;
}
