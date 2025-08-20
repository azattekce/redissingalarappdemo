using System;
using System.Net;
using System.Net.Mail;
using Microsoft.Extensions.Configuration;
using System.Threading.Tasks;

namespace RedisChatApp.Services
{
    public class EmailService
    {
        private readonly IConfiguration _config;
        public EmailService(IConfiguration config)
        {
            _config = config;
        }

        public async Task SendAsync(string to, string subject, string body)
        {
            var host = _config["Email:Smtp:Host"];
            var port = int.TryParse(_config["Email:Smtp:Port"], out var p) ? p : 587;
            var user = _config["Email:Smtp:User"];
            var pass = _config["Email:Smtp:Pass"];
            var from = _config["Email:From"] ?? user;

            // Fallback: if SMTP not configured, log to console and return
            if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(from))
            {
                Console.WriteLine($"[EmailService] To:{to} Subject:{subject} Body:{body}");
                await Task.CompletedTask;
                return;
            }

            using var client = new SmtpClient(host, port)
            {
                EnableSsl = true
            };
            if (!string.IsNullOrWhiteSpace(user))
            {
                client.Credentials = new NetworkCredential(user, pass);
            }
            var mail = new MailMessage(from!, to, subject, body) { IsBodyHtml = false };
            await client.SendMailAsync(mail);
        }
    }
}
