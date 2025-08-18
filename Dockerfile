# Build stage
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Fix SSL issues during restore (install CA certs and update trust store). Allow custom corp CAs.
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ENV http_proxy=$HTTP_PROXY \
	https_proxy=$HTTPS_PROXY \
	no_proxy=$NO_PROXY
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl \
	&& mkdir -p /usr/local/share/ca-certificates/extra \
	&& update-ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Copy any custom CA certs if present
COPY certs/*.crt /usr/local/share/ca-certificates/extra/
RUN update-ca-certificates || true

# Copy csproj and restore (better layer caching)
COPY RedisChatApp.csproj ./
RUN dotnet restore ./RedisChatApp.csproj

# Copy the rest of the source
COPY . .

# Publish
RUN dotnet publish ./RedisChatApp.csproj -c Release -o /app --no-restore

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app

# Ensure non-root user (optional, can be root for simplicity)
# USER app

ENV ASPNETCORE_URLS=http://0.0.0.0:8080
EXPOSE 8080

COPY --from=build /app .

# Default environment variables (can be overridden by compose)
# Use Redis service name in docker-compose as host
ENV Redis__ConnectionString=redis:6379,abortConnect=false
ENV ConnectionStrings__Default=Data Source=/tmp/chat.db

ENTRYPOINT ["dotnet", "RedisChatApp.dll"]
