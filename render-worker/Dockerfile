# Base image ships Manim + all its heavy system deps (cairo, pango, ffmpeg,
# and a LaTeX toolchain for MathTex/Tex). We just add the web server layer.
FROM manimcommunity/manim:stable

# Reset the base image's manim entrypoint so our CMD runs the web server.
ENTRYPOINT []
USER root
WORKDIR /app

RUN pip install --no-cache-dir \
      flask==3.0.3 \
      gunicorn==22.0.0 \
      firebase-admin==6.5.0

COPY main.py .

# Cloud Run injects PORT (defaults to 8080). One worker keeps in-process render
# threads simple; threads handle the fast /render acknowledgements.
ENV PORT=8080
EXPOSE 8080

CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 0 main:app
