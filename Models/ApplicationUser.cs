using Microsoft.AspNetCore.Identity;

namespace RedisChatApp.Models
{
    public class ApplicationUser : IdentityUser
    {
        public string? DisplayName { get; set; }
    }
}
