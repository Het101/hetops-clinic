# Unprivileged nginx listens on 8080 and runs as UID 101.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY web/index.html web/app.js web/style.css /usr/share/nginx/html/
EXPOSE 8080
