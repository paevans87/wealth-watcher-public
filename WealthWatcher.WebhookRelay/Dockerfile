FROM mcr.microsoft.com/dotnet/sdk:10.0@sha256:e1fc6e423f543119c406d24e2e687d67c569f18f04a37a8b0005d80ad0dcee80 AS build
WORKDIR /src
COPY ["WealthWatcher.WebhookRelay.csproj", "./"]
RUN dotnet restore "./WealthWatcher.WebhookRelay.csproj"
COPY . .
RUN dotnet publish "WealthWatcher.WebhookRelay.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0@sha256:207cc51496778557731c81ff670333d8ade4a4fec22768fd1be8e78474a84ecf AS final
WORKDIR /app
RUN mkdir -p /data && chown $APP_UID /data
EXPOSE 8080
COPY --from=build /app/publish .
USER $APP_UID
ENTRYPOINT ["dotnet", "WealthWatcher.WebhookRelay.dll"]
