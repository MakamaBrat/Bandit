"""Extract motion tables used by the original game into assets/tables/tables.json.
 - cos: 256 little-endian int32 from raw_blocks/a_00.bin  (d.G, d.j(n)=cos(2*pi*n/256) in 8.8 fixed point; d.i(n)=d.j(64-n))
 - A:   32 shorts from raw_blocks/e_01.bin, first array: unit vectors for 16 directions (b.A), 8.8 fixed point
 - B:   second array of e_01 (b.B)
Block format of e_01 (d.g): u8 count, then per array: u8 length, length * int16 LE."""
import struct, json, os
root = os.path.join(os.path.dirname(__file__), '..')
rb = lambda n: open(os.path.join(root, 'assets/raw_blocks', n), 'rb').read()
cos = list(struct.unpack('<256i', rb('a_00.bin')[:1024]))
b = rb('e_01.bin'); p = 0; n = b[p]; p += 1; arrs = []
for _ in range(n):
    L = b[p]; p += 1
    arrs.append(list(struct.unpack_from('<%dh' % L, b, p))); p += 2 * L
out = dict(cos=cos, A=arrs[0], B=arrs[1])
json.dump(out, open(os.path.join(root, 'assets/tables/tables.json'), 'w'))
print('cos', cos[:4], 'A', arrs[0][:8], 'B', arrs[1][:6])

# ---- pedestrian turn table b.z (e_00 object 13) and per-level object tables (d.U(int): f_00 = city1, u_00 = city2) ----
def byte_arrays(raw):
    p = 0; n = raw[p]; p += 1; out = []
    for _ in range(n):
        L = raw[p]; p += 1; out.append(list(raw[p:p + L])); p += L
    return out
z = byte_arrays(rb('e_00.bin'))[13]
z = [v - 256 if v > 127 else v for v in z]
d = json.load(open(os.path.join(root, 'assets/tables/tables.json'))); d['z'] = z
json.dump(d, open(os.path.join(root, 'assets/tables/tables.json'), 'w')); print('z', z)

def parse_level_objects(b):
    """Stream of groups per block type: s8 total, then groups (type u8, count u8, fields u8, count*fields LE int16)."""
    n2 = 0; n3 = 0; res = {}
    while n2 < len(b):
        n4 = b[n2]; n2 += 1; n4 = n4 - 256 if n4 > 127 else n4; i = 0
        while i < n4:
            s2, s, n5 = b[n2], b[n2 + 1], b[n2 + 2]; n2 += 3; items = []
            for _ in range(s):
                vals = list(struct.unpack_from('<%dh' % n5, b, n2)); n2 += 2 * n5; items.append(vals)
            res.setdefault(s2, {})[n3] = items; i += s
        n3 += 1
    return res
for tag, blk in (('city1_h', 'f_00'), ('city2_s', 'u_00')):
    r = parse_level_objects(rb(blk + '.bin'))
    # type 9 = pedestrian path nodes bh[blockType]: x, y (px inside block), links E/N (v2 bytes), W/S (v3 bytes), v4 = allowed-direction mask
    # type 0 = car lane segments aY (7 values), type 1 = aZ (mission/triggers, 5 values) -- kept raw for later
    out = {'bh': {str(k): v for k, v in r.get(9, {}).items()}, 'raw': {str(t): {str(k): v for k, v in r[t].items()} for t in r}}
    json.dump(out, open(os.path.join(root, f'assets/maps/{tag}_objects.json'), 'w'))
    print(tag, 'bh block types', len(out['bh']), 'nodes', sum(len(v) for v in out['bh'].values()))
