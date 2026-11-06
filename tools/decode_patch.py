# Usage: python3 tools/decode_patch.py ModuleIndex.json patch.bin  (writes raw.json)
# ModuleIndex.json comes from github.com/meanmedianmoge/zoia_lib (zoia_lib/common/schemas).
import struct,json,sys
mi=json.load(open(sys.argv[1])); b=open(sys.argv[2],'rb').read()
d=struct.unpack('<%di'%(len(b)//4),b)
def s(o,n=16): return b[o:o+n].split(b'\0')[0].decode('latin1')
print('name',s(4),'nmods',d[5])
st=6; mods=[]
for i in range(d[5]):
    size=d[st]; idx=d[st+1]; m=mi[str(idx)]
    np=d[st+6]; opts=list(b[(st+8)*4:(st+10)*4])
    oc=[k for k in m['options']]
    o={k:m['options'][k][opts[j]] if opts[j]<len(m['options'][k]) else ('?',opts[j]) for j,k in enumerate(oc)}
    params=[d[st+10+x] for x in range(np)]
    mods.append(dict(i=i,idx=idx,type=m['name'],ver=d[st+2],page=d[st+3],pos=d[st+5],name=s((st+size-4)*4),opts=o,params=params))
    st+=size
for m in mods: print(m['i'],m['page'],m['pos'],m['idx'],m['type'],'|',m['name'],'|',m['opts'],'|',[round(p/65535,3) for p in m['params']])
nc=d[st]; conns=[]
for j in range(nc):
    conns.append(d[st+1+5*j:st+6+5*j])
st+=5*nc+1
print('conns',nc)
for c in conns: print(' ',c[0],mods[c[0]]['name'] or mods[c[0]]['type'],c[1],'->',c[2],mods[c[2]]['name'] or mods[c[2]]['type'],c[3],c[4]/100)
json.dump(dict(mods=mods,conns=conns),open('raw.json','w'))
