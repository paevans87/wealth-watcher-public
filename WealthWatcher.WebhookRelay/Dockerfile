FROM mcr.microsoft.com/dotnet/sdk:10.0@sha256:e1ffd2a92ae84c1291bc1b6887501f8af98e6331e7af6d4c8d37168c5e87a64c AS build
WORKDIR /src
COPY ["WealthWatcher.WebhookRelay.csproj", "./"]
RUN dotnet restore "./WealthWatcher.WebhookRelay.csproj"
COPY . .
RUN dotnet publish "WealthWatcher.WebhookRelay.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0@sha256:a4556ed033fa96f984bb7a8d348851cb2d36b1281dd2420070045f664fbb5f94 AS final
WORKDIR /app
RUN mkdir -p /data && chown $APP_UID /data
EXPOSE 8080
COPY --from=build /app/publish .
USER $APP_UID
ENTRYPOINT ["dotnet", "WealthWatcher.WebhookRelay.dll"]
