FROM postgres:16-alpine

RUN apk add --no-cache aws-cli openssl

WORKDIR /opt/backup

COPY backup.sh /opt/backup/backup.sh
COPY restore.sh /opt/backup/restore.sh

RUN chmod +x /opt/backup/backup.sh /opt/backup/restore.sh

CMD ["/opt/backup/backup.sh"]
