export function mergeById<T extends {id:string},>(base:T[], over?:T[]):T[]{
  const m=new Map(base.map(x=>[x.id,x]));
  for(const x of over??[]) m.set(x.id,{...m.get(x.id),...x} as T);
  return [...m.values()];
}
