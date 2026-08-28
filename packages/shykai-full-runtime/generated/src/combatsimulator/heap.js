export default class Heap {
  constructor(compare) { this.compare = compare; this.values = []; }
  push(value) {
    const values = this.values;
    values.push(value);
    let index = values.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(values[parent], value) <= 0) break;
      values[index] = values[parent];
      index = parent;
    }
    values[index] = value;
  }
  pop() {
    const values = this.values;
    if (values.length === 0) return undefined;
    const first = values[0];
    const last = values.pop();
    if (values.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        if (left >= values.length) break;
        const right = left + 1;
        const child = right < values.length &&
          this.compare(values[right], values[left]) < 0 ? right : left;
        if (this.compare(values[child], last) >= 0) break;
        values[index] = values[child];
        index = child;
      }
      values[index] = last;
    }
    return first;
  }
  toArray() { return [...this.values]; }
  remove(value) {
    const index = this.values.indexOf(value);
    if (index < 0) return false;
    const last = this.values.pop();
    if (index < this.values.length) {
      this.values[index] = last;
      const copy = [...this.values];
      this.values = [];
      for (const entry of copy) this.push(entry);
    }
    return true;
  }
}
