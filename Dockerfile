# Publicação no EasyPanel (Build: Dockerfile). O site é HTML estático servido pelo nginx.
# O nginx.conf faz o que o .htaccess faz no Apache: URLs limpas, cabeçalhos de segurança, cache e bloqueios.
# O .dockerignore deixa entrar na imagem só o que o site usa (sem node_modules, tests, tools, package.json).
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html/
RUN rm /usr/share/nginx/html/nginx.conf
EXPOSE 80
