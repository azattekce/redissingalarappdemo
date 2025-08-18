using System.ComponentModel.DataAnnotations;

namespace RedisChatApp.Models
{
    public class FriendBlock
    {
        [Key]
        public int Id { get; set; }
        [Required]
        public string BlockerUserId { get; set; } = default!;
        [Required]
        public string BlockedUserId { get; set; } = default!;
    }
}
