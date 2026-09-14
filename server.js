const http=require('http'),fs=require('fs'),path=require('path');
const root='/Users/apple/Desktop/All files/hsk4-practice';
const port=process.env.PORT||7788;
const mt={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css'};
http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/HSK4_Exam_Practice.html';
  const f=path.join(root,u);if(!f.startsWith(root)){res.writeHead(403);return res.end();}
  fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('404');}res.writeHead(200,{'Content-Type':mt[path.extname(f)]||'application/octet-stream'});res.end(d);});
}).listen(port,()=>console.log('serving on '+port));
