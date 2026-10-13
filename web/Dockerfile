# Unprivileged nginx listens on 8080 and runs as UID 101.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/index.html web/app.js web/style.css /usr/share/nginx/html/
EXPOSE 8080
# The base image already runs as 101; saying so here makes it explicit and visible to scanners (Trivy DS-0002).
USER 101
