export function positions(a, b) {
  if (a === b) return [];
  let out = [],
    i = b.indexOf(a);
  while (i !== -1) {
    let k = i === 0 ? "prefix" : i + a.length === b.length ? "suffix" : "infix";
    if (!out.includes(k)) out.push(k);
    i = b.indexOf(a, i + 1);
  }
  return out;
}

export function buildWordRelationships(data) {
  let edges = [];
  for (let i = 0; i < data.length; i++)
    for (let j = 0; j < data.length; j++) {
      let k = positions(data[i][0], data[j][0]);
      if (k.length)
        edges.push({ id: edges.length, from: i, to: j, kind: k.join("/") });
    }
  const alternateReadings = new Set();
  for (let i = 0; i < data.length; i++)
    for (let j = i + 1; j < data.length; j++) {
      if (
        data[i][0] === data[j][0] &&
        data[i][1].trim().toLocaleLowerCase() !==
          data[j][1].trim().toLocaleLowerCase()
      ) {
        alternateReadings.add(i);
        alternateReadings.add(j);
        edges.push({
          id: edges.length,
          from: i,
          to: j,
          kind: "different reading",
          reading: true,
        });
      }
    }
  const neighborSets = data.map(() => new Set());
  edges.forEach((e) => {
    neighborSets[e.from].add(e.to);
    neighborSets[e.to].add(e.from);
  });
  const linkedCounts = neighborSets.map((n) => n.size);

  return { edges, alternateReadings, neighborSets, linkedCounts };
}

export function collectLinkedWords(selectedId, edges, data) {
  const neighbors = new Map();
  for (const edge of edges) {
    if (edge.from !== selectedId && edge.to !== selectedId) continue;
    const outgoing = edge.from === selectedId,
      other = outgoing ? edge.to : edge.from;
    if (other === selectedId || !data[other]) continue;
    if (!neighbors.has(other))
      neighbors.set(other, {
        id: other,
        entry: data[other],
        relations: new Set(),
      });
    const label = edge.reading
      ? "Different reading"
      : outgoing
        ? `${edge.kind} in linked word`
        : `${edge.kind} in selected word`;
    neighbors.get(other).relations.add(label);
  }
  return [...neighbors.values()]
    .map((item) => ({ ...item, relations: [...item.relations] }))
    .sort(
      (a, b) =>
        a.entry[4].localeCompare(b.entry[4]) ||
        a.entry[1].localeCompare(b.entry[1]) ||
        a.id - b.id,
    );
}
